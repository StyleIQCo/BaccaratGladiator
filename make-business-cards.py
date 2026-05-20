#!/usr/bin/env python3
"""
make-business-cards.py
======================
Generates a 2-page print-ready business card PDF for FedEx Office.

Specs
-----
* Page size  : 3.75 in × 2.25 in (1125 × 675 px @ 300 DPI)
              = standard US 3.5×2 card + 1/8" bleed on all sides
* Resolution : 300 DPI
* Pages      : 2 (page 1 = front, page 2 = back)
* Output     : Baccarat_Gladiator_Business_Cards_Print.pdf

Inputs
------
* Front bg   : previews/preview-jiufen-tea.jpg
* Back hero  : book-assets/squeeze-01-face-down.png
* Front QR   : https://baccaratgladiator.com
* Back QR    : https://a.co/07gtSX5R   (Amazon eBook short link)

Run
---
    /tmp/cards-venv/bin/python make-business-cards.py

(See README for venv setup; needs Pillow, qrcode, reportlab.)
"""

import io
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import qrcode
from qrcode.constants import ERROR_CORRECT_H
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

# ─── Repo + paths ────────────────────────────────────────────────────
REPO = Path(__file__).resolve().parent
FRONT_BG = REPO / 'previews' / 'preview-jiufen-tea.jpg'
BACK_HERO = REPO / 'book-assets' / 'squeeze-01-face-down.png'
OUTPUT = REPO / 'Baccarat_Gladiator_Business_Cards_Print.pdf'

# ─── Print spec ──────────────────────────────────────────────────────
DPI = 300
W_IN, H_IN = 3.75, 2.25                    # full bleed size
WIDTH, HEIGHT = int(W_IN * DPI), int(H_IN * DPI)   # 1125 × 675

# ─── Brand colors ────────────────────────────────────────────────────
GOLD = (240, 208, 128)        # #f0d080
GOLD_DEEP = (201, 168, 76)    # #c9a84c
DARK_BG = (8, 14, 8)          # #080e08
DARK_BG2 = (20, 30, 20)       # subtle gradient stop
RIBBON_GOLD = (212, 175, 55)   # #d4af37 — Roman / metallic gold (mid)
RIBBON_GOLD_DARK = (138, 90, 25)   # #8a5a19 — bronze (top + bottom of sheen)
RIBBON_GOLD_BRIGHT = (255, 223, 115)  # #ffdf73 — catchlight stripe
RIBBON_FOLD = (90, 56, 14)     # #5a380e — fold-back shadow (deeper than bronze)
RIBBON_BORDER = (0, 0, 0)      # #000000 — outer black border + text
RIBBON_INNER_LINE = (40, 22, 6)    # #28160a — etched inner border


# ─── Font resolution ─────────────────────────────────────────────────
# We try a chain of installed fonts so the script works on a fresh
# machine without Cinzel installed. Pillow can render any TTF/OTF
# directly — no need to install fonts system-wide.
def _find_font(size, bold=True, italic=False):
    candidates = []
    if bold and italic:
        candidates += [
            '/System/Library/Fonts/Supplemental/Georgia Bold Italic.ttf',
            '/Library/Fonts/Cinzel-Black.ttf',
        ]
    elif bold:
        candidates += [
            '/Library/Fonts/Cinzel-Black.ttf',
            '/Library/Fonts/Cinzel-Bold.ttf',
            '/System/Library/Fonts/Supplemental/Trajan Pro.ttf',
            '/System/Library/Fonts/Supplemental/Georgia Bold.ttf',
            '/System/Library/Fonts/Avenir Next.ttc',
        ]
    elif italic:
        candidates += [
            '/System/Library/Fonts/Supplemental/Georgia Italic.ttf',
        ]
    else:
        candidates += [
            '/Library/Fonts/Cinzel-Regular.ttf',
            '/System/Library/Fonts/Supplemental/Georgia.ttf',
        ]

    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue

    print(f'  [warn] no preferred font found, falling back to PIL default '
          f'(text may look smaller than expected at size={size})',
          file=sys.stderr)
    return ImageFont.load_default()


# ─── Image helpers ───────────────────────────────────────────────────
def _ensure_input(path: Path, kind: str) -> None:
    """Required by the brief: if a source image is missing, create a
    dummy placeholder so the script still runs end-to-end."""
    if path.exists():
        return
    print(f'  [warn] {path} missing — generating a placeholder '
          f'so the build can complete')
    path.parent.mkdir(parents=True, exist_ok=True)
    placeholder = Image.new('RGB', (1200, 800), DARK_BG)
    d = ImageDraw.Draw(placeholder)
    font = _find_font(40)
    label = f'PLACEHOLDER · {kind}\n{path.name}'
    d.multiline_text(
        (40, 360), label, fill=GOLD, font=font, spacing=8,
    )
    placeholder.save(path)


def _center_crop_to_ratio(im: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Center-crop to the target aspect ratio, then resize to (w, h)."""
    src_w, src_h = im.size
    target_ratio = target_w / target_h
    src_ratio = src_w / src_h

    if src_ratio > target_ratio:
        # Source is wider than target — crop horizontally
        new_w = int(round(src_h * target_ratio))
        left = (src_w - new_w) // 2
        box = (left, 0, left + new_w, src_h)
    else:
        # Source is taller than target — crop vertically
        new_h = int(round(src_w / target_ratio))
        top = (src_h - new_h) // 2
        box = (0, top, src_w, top + new_h)

    return im.crop(box).resize((target_w, target_h), Image.LANCZOS)


def _make_qr(url: str, px: int) -> Image.Image:
    """Generate a high-ECC QR code, white-on-black, scaled to `px` px square."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=20,
        border=2,   # 2-module quiet zone is the QR spec minimum
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color='black', back_color='white').convert('RGB')
    return img.resize((px, px), Image.LANCZOS)


def _draw_text_centered(d: ImageDraw.ImageDraw, xy, text, font, fill, max_w=None):
    """Draw `text` centered horizontally at xy=(cx, top_y)."""
    cx, top = xy
    bbox = d.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    d.text((cx - text_w // 2, top - bbox[1]), text, fill=fill, font=font)
    return text_h


def _interpolate_stops(stops, t):
    """Linear-interpolate a multi-stop gradient. `stops` is a list of
    (position, (r, g, b)) where position is in [0, 1]."""
    if t <= stops[0][0]:
        return stops[0][1]
    if t >= stops[-1][0]:
        return stops[-1][1]
    for i in range(len(stops) - 1):
        p1, c1 = stops[i]
        p2, c2 = stops[i + 1]
        if p1 <= t <= p2:
            f = (t - p1) / (p2 - p1) if p2 > p1 else 0.0
            return (
                int(round(c1[0] + (c2[0] - c1[0]) * f)),
                int(round(c1[1] + (c2[1] - c1[1]) * f)),
                int(round(c1[2] + (c2[2] - c1[2]) * f)),
            )
    return stops[-1][1]


def _vertical_gradient_strip(w: int, h: int, stops):
    """Build a w×h RGB image filled with a vertical multi-stop gradient.
    One ImageDraw.line per row — fast enough for the ribbon's <100k px."""
    g = Image.new('RGB', (w, h))
    gd = ImageDraw.Draw(g)
    last_h = max(1, h - 1)
    for y in range(h):
        gd.line([(0, y), (w - 1, y)],
                fill=_interpolate_stops(stops, y / last_h))
    return g


def _crop_tight_to_card(im: Image.Image) -> Image.Image:
    """The squeeze image is a face-down card on a mostly-black canvas.
    Crop tight to the card with a small halo of breathing room. Coords
    derived empirically: the card bounding box in the 1560×1520 source
    is (614, 384) to (947, 832).
    """
    src_w, src_h = im.size
    if (src_w, src_h) == (1560, 1520):
        # 30 px halo all sides
        return im.crop((584, 354, 977, 862))
    # Fallback: scale the box proportionally if dimensions differ.
    sx, sy = src_w / 1560, src_h / 1520
    return im.crop((
        int(584 * sx), int(354 * sy),
        int(977 * sx), int(862 * sy),
    ))


# ─── Card composition ────────────────────────────────────────────────
def build_front() -> Image.Image:
    """Per the brief: jiufen background + QR code right-aligned with a
    white background for contrast. Minimal — let the image carry the
    front, the QR carries the action."""
    print('  · building front')
    bg = Image.open(FRONT_BG).convert('RGB')
    card = _center_crop_to_ratio(bg, WIDTH, HEIGHT)

    # Gentle full-image darken (~22%) so the QR tile and inner border
    # read against an otherwise busy frame without obliterating the art.
    overlay = Image.new('RGBA', card.size, (0, 0, 0, 55))
    card = card.convert('RGBA')
    card.alpha_composite(overlay)
    card = card.convert('RGB')

    d = ImageDraw.Draw(card)

    # Subtle gold inner frame (sits inside the safe zone — 0.25" inset
    # from the bleed edge keeps it 0.125" inside the cut line)
    safe_inset = int(0.25 * DPI)
    d.rectangle(
        (safe_inset, safe_inset, WIDTH - safe_inset, HEIGHT - safe_inset),
        outline=GOLD_DEEP, width=3,
    )

    # QR — upper-left, compact. Sized to nestle inside the corner
    # without crossing into the lanterns in the Jiufen preview.
    qr_size = 165
    qr_x = safe_inset + 22
    qr_y = safe_inset + 22

    # White tile under QR with gold border for high contrast
    pad = 11
    d.rectangle(
        (qr_x - pad, qr_y - pad, qr_x + qr_size + pad, qr_y + qr_size + pad),
        fill='white', outline=GOLD, width=3,
    )
    qr_img = _make_qr('https://a.co/07gtSX5R', qr_size)
    card.paste(qr_img, (qr_x, qr_y))

    # URL caption — small, gold, centered under the QR
    cap_font = _find_font(16, bold=True)
    cap_cx = qr_x + qr_size // 2
    _draw_text_centered(d, (cap_cx, qr_y + qr_size + pad + 10),
                        'GET THE BOOK', cap_font, GOLD)

    # ── Gladiator ribbon — premium / "boujee" treatment ─────────────
    # Layered build (bottom → top):
    #   1. Blurred black drop shadow on an RGBA layer (3D lift)
    #   2. Fold-back triangles in deep bronze (depth at the seams)
    #   3. Metallic vertical gradient (dark bronze → catchlight gold →
    #      mid gold → dark bronze) masked to the ribbon polygon
    #   4. Crisp 5 px black outer outline
    #   5. Inset 2 px dark-brown etched inner border (mint look)
    #   6. URL text — large bold serif, black, with a 1 px white
    #      drop-shadow lower-right for the engraved-into-gold look
    #
    # Geometry stays inside the FedEx safe zone (x ∈ [75, 1050],
    # y ∈ [75, 600] at 300 DPI).
    ribbon_cx = WIDTH // 2
    ribbon_mid_y = 545                 # nudged up a hair to leave room
                                       # for the drop shadow + folds
    ribbon_half_h = 42                 # ribbon half-height (total 84 px)
    ribbon_top = ribbon_mid_y - ribbon_half_h
    ribbon_bot = ribbon_mid_y + ribbon_half_h

    plaque_half_w = 265                # plaque half-width (total 530 px)
    plaque_l = ribbon_cx - plaque_half_w
    plaque_r = ribbon_cx + plaque_half_w

    tail_len = 95                      # length of each tail beyond plaque
    notch = 32                         # V-notch depth at outer tail tip
    outer_l = plaque_l - tail_len
    outer_r = plaque_r + tail_len

    ribbon_pts = [
        (outer_l,         ribbon_top),
        (outer_r,         ribbon_top),
        (outer_r - notch, ribbon_mid_y),
        (outer_r,         ribbon_bot),
        (outer_l,         ribbon_bot),
        (outer_l + notch, ribbon_mid_y),
    ]

    # Need transparency for the drop shadow — promote the card to RGBA
    # for the whole ribbon block. (Converted back to RGB before return.)
    card = card.convert('RGBA')

    # ── 1. 3D drop shadow ───────────────────────────────────────────
    shadow_offset = 10
    shadow_layer = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.polygon(
        [(x + shadow_offset, y + shadow_offset) for x, y in ribbon_pts],
        fill=(0, 0, 0, 175),
    )
    # Also include the fold-back tails in the shadow so the lift looks
    # consistent under the entire shape.
    fold_h = 12
    for fold_pts in (
        [(plaque_l, ribbon_bot), (plaque_l - 24, ribbon_bot + fold_h),
         (plaque_l + 6, ribbon_bot)],
        [(plaque_r, ribbon_bot), (plaque_r + 24, ribbon_bot + fold_h),
         (plaque_r - 6, ribbon_bot)],
    ):
        sd.polygon(
            [(x + shadow_offset, y + shadow_offset) for x, y in fold_pts],
            fill=(0, 0, 0, 175),
        )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=9))
    card.alpha_composite(shadow_layer)

    # Fresh draw context bound to the RGBA card from here on.
    d = ImageDraw.Draw(card)

    # ── 2. Fold-back triangles ──────────────────────────────────────
    d.polygon([
        (plaque_l,      ribbon_bot),
        (plaque_l - 24, ribbon_bot + fold_h),
        (plaque_l + 6,  ribbon_bot),
    ], fill=RIBBON_FOLD, outline=RIBBON_BORDER, width=2)
    d.polygon([
        (plaque_r,      ribbon_bot),
        (plaque_r + 24, ribbon_bot + fold_h),
        (plaque_r - 6,  ribbon_bot),
    ], fill=RIBBON_FOLD, outline=RIBBON_BORDER, width=2)

    # ── 3. Metallic gradient fill (masked) ──────────────────────────
    bbox_l, bbox_t = outer_l, ribbon_top
    bbox_w = outer_r - outer_l
    bbox_h = ribbon_bot - ribbon_top

    sheen_stops = [
        (0.00, RIBBON_GOLD_DARK),     # dark bronze along the top edge
        (0.28, RIBBON_GOLD_BRIGHT),   # catchlight band
        (0.55, RIBBON_GOLD),          # standard gold middle-low
        (0.82, (170, 130, 35)),       # midtone bronze
        (1.00, RIBBON_GOLD_DARK),     # back to dark bronze along bottom
    ]
    grad = _vertical_gradient_strip(bbox_w, bbox_h, sheen_stops)

    mask = Image.new('L', (bbox_w, bbox_h), 0)
    md = ImageDraw.Draw(mask)
    md.polygon(
        [(x - bbox_l, y - bbox_t) for x, y in ribbon_pts],
        fill=255,
    )
    card.paste(grad, (bbox_l, bbox_t), mask=mask)

    # ── 4. Outer black border (5 px) ────────────────────────────────
    # Drawn AFTER the gradient paste so the border sits cleanly over
    # any anti-aliased gradient edge.
    d.polygon(ribbon_pts, outline=RIBBON_BORDER, width=5)

    # ── 5. Etched inner border (~6 px inset, 2 px line) ─────────────
    inset = 7
    inner_pts = [
        (outer_l + inset,          ribbon_top + inset),
        (outer_r - inset,          ribbon_top + inset),
        (outer_r - notch + inset,  ribbon_mid_y),
        (outer_r - inset,          ribbon_bot - inset),
        (outer_l + inset,          ribbon_bot - inset),
        (outer_l + notch - inset,  ribbon_mid_y),
    ]
    d.polygon(inner_pts, outline=RIBBON_INNER_LINE, width=2)

    # ── 6. Engraved URL text ────────────────────────────────────────
    url_text = 'www.BaccaratGladiator.com'
    inner_pad_x = 28
    inner_pad_y = 12
    max_text_w = (plaque_r - plaque_l) - 2 * inner_pad_x
    max_text_h = (ribbon_bot - ribbon_top) - 2 * inner_pad_y

    ribbon_font = None
    for size in range(60, 18, -2):
        candidate = _find_font(size, bold=True)
        bb = d.textbbox((0, 0), url_text, font=candidate)
        if (bb[2] - bb[0]) <= max_text_w and (bb[3] - bb[1]) <= max_text_h:
            ribbon_font = candidate
            break
    if ribbon_font is None:
        ribbon_font = _find_font(20, bold=True)

    bb = d.textbbox((0, 0), url_text, font=ribbon_font)
    text_w = bb[2] - bb[0]
    text_h = bb[3] - bb[1]
    text_x = ribbon_cx - text_w // 2
    text_y = ribbon_mid_y - text_h // 2 - bb[1]

    # Faint white drop-shadow offset 1 px down-right → engraved channel
    # catches light on the lower-right wall.
    d.text((text_x + 1, text_y + 1), url_text,
           fill=(255, 255, 255, 120), font=ribbon_font)
    d.text((text_x, text_y), url_text,
           fill=RIBBON_BORDER, font=ribbon_font)

    # Card returns to RGB for the PDF assembly path.
    card = card.convert('RGB')
    return card


def build_back() -> Image.Image:
    """Per the brief: card image (cropped tight to focus on the card),
    bold centered tagline, QR for the eBook. Three-band vertical
    layout: hero card on the left, tagline + QR stacked on the right."""
    print('  · building back')
    # Dark vertical gradient background
    card = Image.new('RGB', (WIDTH, HEIGHT), DARK_BG)
    px = card.load()
    for y in range(HEIGHT):
        t = y / HEIGHT
        r = int(DARK_BG[0] + (DARK_BG2[0] - DARK_BG[0]) * t)
        g = int(DARK_BG[1] + (DARK_BG2[1] - DARK_BG[1]) * t)
        b = int(DARK_BG[2] + (DARK_BG2[2] - DARK_BG[2]) * t)
        for x in range(WIDTH):
            px[x, y] = (r, g, b)

    d = ImageDraw.Draw(card)

    # Gold inner frame (matches front)
    safe_inset = int(0.25 * DPI)
    d.rectangle(
        (safe_inset, safe_inset, WIDTH - safe_inset, HEIGHT - safe_inset),
        outline=GOLD_DEEP, width=3,
    )

    # ── Left: hero card image (cropped tight to the card itself) ────
    hero_src = Image.open(BACK_HERO).convert('RGB')
    hero = _crop_tight_to_card(hero_src)

    # Scale hero to ~85% of usable height; the card art has its own
    # halo of glow, so leaving a tiny margin reads cleaner.
    hero_h = int(HEIGHT * 0.85)
    hero_ratio = hero.size[0] / hero.size[1]
    hero_w = int(hero_h * hero_ratio)
    hero = hero.resize((hero_w, hero_h), Image.LANCZOS)

    hero_x = safe_inset + 20
    hero_y = (HEIGHT - hero_h) // 2
    card.paste(hero, (hero_x, hero_y))

    # ── Right: tagline + QR ─────────────────────────────────────────
    right_left = hero_x + hero_w + 26
    right_w = WIDTH - safe_inset - right_left
    right_cx = right_left + right_w // 2

    # Tagline — bold, large, centered, two lines.
    line1_font = _find_font(50, bold=True)
    line2_font = _find_font(74, bold=True, italic=True)

    tline_y = int(HEIGHT * 0.12)
    _draw_text_centered(d, (right_cx, tline_y),
                        'Are you not', line1_font, GOLD)
    # "Entertained?" — shifted ~25 px left of the column center because
    # the bold-italic glyphs slant rightward and the "?" terminal would
    # otherwise creep past the gold safe-zone frame.
    _draw_text_centered(d, (right_cx - 25, tline_y + 70),
                        'Entertained?', line2_font, GOLD)

    # Slim gold rule under the tagline
    rule_y = tline_y + 195
    rule_w = int(right_w * 0.5)
    d.rectangle((right_cx - rule_w // 2, rule_y,
                 right_cx + rule_w // 2, rule_y + 2),
                fill=GOLD_DEEP)

    # QR for the book — Amazon short link
    qr_size = 230
    qr_x = right_cx - qr_size // 2
    qr_y = rule_y + 30

    pad = 14
    d.rectangle(
        (qr_x - pad, qr_y - pad, qr_x + qr_size + pad, qr_y + qr_size + pad),
        fill='white', outline=GOLD, width=4,
    )
    qr_img = _make_qr('https://baccaratgladiator.com', qr_size)
    card.paste(qr_img, (qr_x, qr_y))

    return card


# ─── PDF assembly ────────────────────────────────────────────────────
def write_pdf(front: Image.Image, back: Image.Image, out: Path) -> None:
    """Write the two-page PDF directly via PIL.

    Previously this used ReportLab, which wrapped each rendered card in
    an XObject form. Some print-service preview tools (including
    FedEx Office's upload preview) misinterpret the XObject orientation
    and auto-rotate the page 90°. PIL's PDF writer embeds the images
    natively with the page size derived from `pixels / resolution`,
    which produces a flat, universally-rendered PDF — landscape page
    size of 3.75 × 2.25 in is unambiguous to every viewer.
    """
    print(f'  · writing PDF to {out}')
    # Ensure both pages are RGB (no alpha) — some PDF previews choke on
    # PNGs with alpha embedded in a PDF stream.
    fr = front.convert('RGB') if front.mode != 'RGB' else front
    bk = back.convert('RGB') if back.mode != 'RGB' else back
    fr.save(
        str(out),
        save_all=True,
        append_images=[bk],
        format='PDF',
        resolution=float(DPI),
    )


# ─── Main ────────────────────────────────────────────────────────────
def main():
    print('Baccarat Gladiator — business card PDF builder')
    print(f'Target: {WIDTH}×{HEIGHT} px @ {DPI} DPI · 2 pages · {OUTPUT.name}')

    _ensure_input(FRONT_BG, 'front background')
    _ensure_input(BACK_HERO, 'back hero')

    front = build_front()
    back = build_back()

    # Also save individual PNGs for FedEx fallback (image upload path)
    front_png = REPO / 'card_front.png'
    back_png = REPO / 'card_back.png'
    front.save(front_png, dpi=(DPI, DPI))
    back.save(back_png, dpi=(DPI, DPI))
    print(f'  · saved {front_png.name} + {back_png.name} '
          f'(use these if PDF upload misbehaves)')

    write_pdf(front, back, OUTPUT)

    print(f'\nDONE → {OUTPUT}')
    print(f'  size: {OUTPUT.stat().st_size / 1024:.1f} KB')


if __name__ == '__main__':
    main()
