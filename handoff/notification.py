"""
Cards Tracker — Telegram notification graphic.
Pure Pillow. Warm terracotta bg + soft sage card.

fonts/ directory must contain:
  Poppins-Regular.ttf, Poppins-Medium.ttf, Poppins-Bold.ttf, Poppins-Light.ttf
"""

import io, os
from PIL import Image, ImageDraw, ImageFont

# ── Palette ──────────────────────────────────────────────────────
P = {
    "bg":          (232, 200, 180),
    "card":        (224, 232, 220),
    "ink":         (48,  58,  46),
    "ink_soft":    (118, 132, 114),
    "muted":       (204, 214, 200),
    "accent":      (98,  124, 90),
    "accent_soft": (210, 220, 204),
    "warm":        (170, 92,  64),
    "warm_soft":   (244, 218, 200),
}

FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
def _f(size, w="r"):
    weights = {"r":"Regular","m":"Medium","b":"Bold","l":"Light"}
    return ImageFont.truetype(os.path.join(FONT_DIR, f"Poppins-{weights[w]}.ttf"), size)

# ── Layout ────────────────────────────────────────────────────────
W       = 820
PAD     = 24          # outer margin (bg → card edge)
IX      = PAD + 22    # inner left x
RX      = W - PAD - 22  # inner right x
R       = 18          # card corner radius


def _rr(d, xy, r, fill):
    d.rounded_rectangle(xy, radius=r, fill=fill)

def _tw(d, t, f):
    return d.textlength(t, font=f)

def _divider(d, y):
    d.line([IX, y, RX, y], fill=P["muted"], width=1)

def _label(d, x, y, text):
    """Section label — accent green, 13 Bold, uppercase, with left accent bar."""
    bar_h = 14
    d.rectangle([x, y + 1, x + 3, y + bar_h], fill=P["accent"])
    d.text((x + 10, y), text.upper(), font=_f(13, "b"), fill=P["accent"])

def _pill(d, text, kind, card_right):
    """Draw pill; returns (px, py, pw, ph) for height calc."""
    f  = _f(11, "m")
    pw = _tw(d, text, f) + 24
    px = card_right - pw
    py = PAD + 16
    bg, fg = (P["warm_soft"], P["warm"]) if kind == "new" else (P["accent_soft"], P["accent"])
    _rr(d, [px, py, px + pw, py + 22], r=11, fill=bg)
    d.text((px + 12, py + 4), text, font=f, fill=fg)


# ── render_notification ───────────────────────────────────────────
def render_notification(date_str, tx_by_card, statement_cards, timestamp,
                        mtd=None, month_label="MTD"):
    """
    tx_by_card      : [(card_name, [{"date","merchant","category","amount"}, ...]), ...]
    statement_cards : [{"card","last4","stmt_date","txn_count","unmatched","diff"}, ...]
    mtd             : [{"card","amount"}, ...]  — optional MTD block at bottom
    """
    mtd = mtd or []

    # ── height calculation ────────────────────────────────────────
    HEADER_H  = 54
    TX_ROW_H  = 26
    GRP_GAP   = 10    # gap between card groups
    GRP_HDR   = 22    # card name → first row
    STMT_ROW  = 32
    MTD_ROW   = 26
    SEC_PAD   = 8     # label → content below it

    n_grp  = len(tx_by_card)
    n_rows = sum(len(r) for _, r in tx_by_card)
    tx_h   = 16 + SEC_PAD + n_grp * GRP_HDR + n_rows * TX_ROW_H + max(0, n_grp-1) * GRP_GAP
    st_h   = 16 + SEC_PAD + len(statement_cards) * STMT_ROW
    mt_h   = (16 + SEC_PAD + len(mtd) * MTD_ROW) if mtd else 0

    FOOTER_ZONE = 32   # terracotta strip below card
    CARD_H = PAD + HEADER_H + tx_h + 14 + st_h + (14 + mt_h if mtd else 0) + 20
    H      = CARD_H + PAD + FOOTER_ZONE

    # ── canvas ────────────────────────────────────────────────────
    img = Image.new("RGB", (W, H), P["bg"])
    d   = ImageDraw.Draw(img)
    _rr(d, [PAD, PAD, W-PAD, CARD_H], r=R, fill=P["card"])

    # ── header ───────────────────────────────────────────────────
    hy    = PAD + 18
    title = f"Cards Summary  ·  {date_str}"
    d.text((IX, hy), title, font=_f(15, "b"), fill=P["ink"])
    n_new = sum(len(r) for _, r in tx_by_card)
    _pill(d, f"{n_new} new" if n_new else "all clear", "new" if n_new else "clear", RX)

    div_y = PAD + HEADER_H
    _divider(d, div_y)

    # ── transactions ──────────────────────────────────────────────
    y = div_y + 16
    _label(d, IX, y, "Transactions")
    y += SEC_PAD + 10   # label height ≈ 10px

    for i, (card_name, rows) in enumerate(tx_by_card):
        if i > 0:
            y += GRP_GAP
        d.text((IX, y), card_name, font=_f(12, "b"), fill=P["ink"])
        y += GRP_HDR
        for tx in rows:
            d.text((IX,      y), tx["date"],                       font=_f(11, "m"), fill=P["ink_soft"])
            d.text((IX + 72, y), f"{tx['merchant']}  ·  {tx['category']}", font=_f(11, "r"), fill=P["ink"])
            aw = _tw(d, tx["amount"], _f(13, "m"))
            d.text((RX - aw, y - 1), tx["amount"],                 font=_f(13, "m"), fill=P["ink"])
            y += TX_ROW_H

    # ── statement ─────────────────────────────────────────────────
    y += 14
    _divider(d, y)
    y += 14
    _label(d, IX, y, "Statement")
    y += SEC_PAD + 10

    for sc in statement_cards:
        lbl = sc["card"]
        if sc.get("last4"):    lbl += f"  ·  {sc['last4']}"
        if sc.get("stmt_date"):lbl += f"  ({sc['stmt_date']})"
        d.text((IX, y), lbl, font=_f(12, "m"), fill=P["ink"])

        info = [f"{sc.get('txn_count',0)} txn{'s' if sc.get('txn_count',0)!=1 else ''}"]
        if sc.get("unmatched", 0): info.append(f"{sc['unmatched']} unmatched")
        if sc.get("diff", 0) > 1:  info.append(f"diff {sc['diff']:,.0f}")
        s = "  ·  ".join(info)
        sw = _tw(d, s, _f(11, "r"))
        d.text((RX - sw, y + 1), s, font=_f(11, "r"), fill=P["ink_soft"])
        y += STMT_ROW

    # ── MTD ───────────────────────────────────────────────────────
    if mtd:
        y += 14
        _divider(d, y)
        y += 14
        _label(d, IX, y, month_label)
        y += SEC_PAD + 10
        for row in mtd:
            d.text((IX, y), row["card"], font=_f(12, "r"), fill=P["ink"])
            aw = _tw(d, row["amount"], _f(13, "m"))
            d.text((RX - aw, y - 1), row["amount"], font=_f(13, "m"), fill=P["ink"])
            y += MTD_ROW

    # ── footer (in terracotta border below card) ──────────────────
    fy = CARD_H + (FOOTER_ZONE + PAD) // 2 - 6
    fc = (200, 160, 140)   # warm muted tone on terracotta bg
    d.text((IX, fy), "cards tracker", font=_f(10, "r"), fill=fc)
    tw = _tw(d, timestamp, _f(10, "r"))
    d.text((RX - tw, fy), timestamp, font=_f(10, "r"), fill=fc)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── render_no_new ─────────────────────────────────────────────────
def render_no_new(date_str, mtd, timestamp, month_label="MTD"):
    """
    mtd: [{"card","amount"}, ...]
    """
    MTD_ROW     = 26
    SEC_PAD     = 8
    HEADER_H    = 54
    FOOTER_ZONE = 32
    mt_h    = 16 + SEC_PAD + len(mtd) * MTD_ROW
    CARD_H  = PAD + HEADER_H + 70 + 14 + mt_h + 20
    H       = CARD_H + PAD + FOOTER_ZONE

    img = Image.new("RGB", (W, H), P["bg"])
    d   = ImageDraw.Draw(img)
    _rr(d, [PAD, PAD, W-PAD, CARD_H], r=R, fill=P["card"])

    hy    = PAD + 18
    d.text((IX, hy), f"Cards Summary  ·  {date_str}", font=_f(15, "b"), fill=P["ink"])
    _pill(d, "all clear", "clear", RX)

    div_y = PAD + HEADER_H
    _divider(d, div_y)

    y = div_y + 20
    d.text((IX, y),      "No new transactions",          font=_f(16, "m"), fill=P["ink"])
    d.text((IX, y + 26), "All caught up since last check", font=_f(11, "l"), fill=P["ink_soft"])

    y += 70
    _divider(d, y)
    y += 14
    _label(d, IX, y, month_label)
    y += SEC_PAD + 10
    for row in mtd:
        d.text((IX, y), row["card"], font=_f(12, "r"), fill=P["ink"])
        aw = _tw(d, row["amount"], _f(13, "m"))
        d.text((RX - aw, y - 1), row["amount"], font=_f(13, "m"), fill=P["ink"])
        y += MTD_ROW

    fy = CARD_H + (FOOTER_ZONE + PAD) // 2 - 6
    fc = (200, 160, 140)
    d.text((IX, fy), "cards tracker", font=_f(10, "r"), fill=fc)
    tw = _tw(d, timestamp, _f(10, "r"))
    d.text((RX - tw, fy), timestamp, font=_f(10, "r"), fill=fc)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── Telegram ──────────────────────────────────────────────────────
def send_to_telegram(bot_token, chat_id, png_bytes, caption=None):
    import requests
    r = requests.post(
        f"https://api.telegram.org/bot{bot_token}/sendPhoto",
        data={"chat_id": chat_id, **({"caption": caption} if caption else {})},
        files={"photo": ("notification.png", png_bytes, "image/png")},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


# ── Sample run ────────────────────────────────────────────────────
if __name__ == "__main__":
    png = render_notification(
        date_str="26 April 2026",
        tx_by_card=[
            ("Times Black", [
                {"date": "12 Apr", "merchant": "Times Internet", "category": "Misc",     "amount": "100"},
                {"date": "14 Apr", "merchant": "Swiggy",         "category": "Food",     "amount": "450"},
            ]),
            ("Magnus Burgundy", [
                {"date": "28 Apr", "merchant": "CLAUDE*AI S",    "category": "Software", "amount": "1,937"},
            ]),
        ],
        statement_cards=[
            {"card": "Times Black",     "last4": "4003", "stmt_date": "27 May", "txn_count": 2, "unmatched": 0,   "diff": 0},
            {"card": "Magnus Burgundy", "last4": "8930", "stmt_date": "1 May",  "txn_count": 1, "unmatched": 1, "diff": 250},
        ],
        mtd=[
            {"card": "Magnus Burgundy", "amount": "18.8L"},
            {"card": "Infinia",         "amount": "450"},
            {"card": "Times Black",     "amount": "1"},
        ],
        month_label="Apr 2026 MTD",
        timestamp="6:58 pm",
    )
    with open("preview_v3.png", "wb") as f:
        f.write(png)

    png2 = render_no_new(
        date_str="26 April 2026",
        month_label="Apr 2026 MTD",
        mtd=[
            {"card": "Magnus Burgundy", "amount": "18.8L"},
            {"card": "Infinia",         "amount": "450"},
            {"card": "Times Black",     "amount": "1"},
        ],
        timestamp="8:19 pm",
    )
    with open("preview_clear_v3.png", "wb") as f:
        f.write(png2)

    print("Wrote preview_v3.png and preview_clear_v3.png")
