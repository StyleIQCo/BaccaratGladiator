#!/usr/bin/env python3
"""
Baccarat Gladiator — Dragon 7 → 15s YouTube Short builder
==========================================================

Audio pipeline (Plan A — Demucs):
  1. Extract WAV from dragon7_clip.mp4.
  2. Run Demucs (htdemucs, two-stem mode) to isolate vocals from
     "no_vocals" — the dealer's "nicely played" line lands in `vocals`,
     while the droning ambience / synthesized FX live in `no_vocals`.
     Discard `no_vocals`, keep `vocals` as the only original-source bed.
  3. Mix in `assets/bramm.mp3` at 0:03 (Hook → Climax handoff) with
     sidechaincompress audio-ducking so the BRAMM ducks the bed by ~6 dB.
  4. Master at AAC 320 kbps · 48 kHz · alimiter ceiling 0.97.

Audio pipeline (Plan B — `--plan-b <track>`):
  Skip Demucs entirely. Mute the source. Use the provided cinematic bed
  for the full 15 s, ducked under BRAMM at 0:03. Same mastering chain.

Video pipeline:
  · 1080×1920 9:16 · 30 fps
  · libx264 CRF 18 preset slow · pixfmt yuv420p
  · LANCZOS for any resize (`scale=...:flags=lanczos`)
  · 0:00–0:03 Hook  — Ken Burns zoom on a source frame, weathered-stone headline
  · 0:03–0:10 Climax — source[2:9] re-encoded, gold "ARE YOU NOT ENTERTAINED?!"
                       overlay during the win moment, heat-haze (`geq` warp)
  · 0:10–0:15 CTA   — Pillow-rendered end card: blurred final frame +
                       semi-transparent black, MASTER THE ARENA,
                       BaccaratGladiator.com, QR code, "60+ STAGES" ticker.

Run
---
  pip install demucs torch torchaudio Pillow numpy
  python3 make_dragon7_short.py                       # Plan A (Demucs)
  python3 make_dragon7_short.py --plan-b assets/bed.mp3   # Plan B (mute+bed)
  python3 make_dragon7_short.py --no-demucs           # Same as plan-b w/ synth bed
"""

from __future__ import annotations

import argparse
import logging
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

# ─── Constants ────────────────────────────────────────────────────────
ROOT     = Path(__file__).parent.resolve()
INPUT    = ROOT / "dragon7_clip.mp4"
OUTPUT   = ROOT / "baccarat_gladiator_short.mp4"
ASSETS   = ROOT / "assets"
WORK     = Path("/tmp/d7_pyshort")

W, H, FPS         = 1080, 1920, 30
HOOK_DUR          = 3
CLIMAX_DUR        = 7
CTA_DUR           = 5
TOTAL_DUR         = HOOK_DUR + CLIMAX_DUR + CTA_DUR     # 15
SRC_CLIMAX_START  = 2.0     # source[2:9] forms the climax slice
WIN_T_IN_CLIMAX   = 2.5     # Dragon 7 reveal lands at climax t=2.5s (final t=5.5s)
HEAT_HAZE_START   = 2.2     # heat-haze on climax window (relative to climax start)
HEAT_HAZE_END     = 4.4

GOLD              = "#FFD700"
GOLD_BRIGHT       = "#FFE34D"
GOLD_DEEP         = "#B8860B"
CRIMSON           = "#5A0010"
INK               = "#1A0408"
CREAM             = "#FFF7D6"

# ─── Logging ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("d7-short")


# ─── Shell helper ─────────────────────────────────────────────────────
def run(cmd, *, capture: bool = False, cwd: Path | None = None) -> subprocess.CompletedProcess:
    """Run a shell command. List or string accepted. Logs the invocation."""
    if isinstance(cmd, (list, tuple)):
        printable = " ".join(str(c) for c in cmd)
    else:
        printable = cmd
    short = printable if len(printable) < 220 else printable[:220] + "  …"
    log.info("$ %s", short)
    return subprocess.run(
        cmd,
        check=True,
        shell=isinstance(cmd, str),
        cwd=cwd,
        capture_output=capture,
        text=capture,
    )


# ─── Dependency check ────────────────────────────────────────────────
def check_dependencies(use_demucs: bool) -> None:
    """Verify required system tools + Python modules are available."""
    log.info("Checking dependencies …")
    if not shutil.which("ffmpeg"):
        log.error("ffmpeg not found. Install via:  brew install ffmpeg")
        sys.exit(1)

    missing: list[str] = []
    try:
        import PIL  # noqa: F401
    except ImportError:
        missing.append("Pillow")
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append("numpy")

    if use_demucs:
        try:
            import demucs.separate  # noqa: F401
        except ImportError:
            missing.append("demucs")
        try:
            import torch  # noqa: F401
            import torchaudio  # noqa: F401
        except ImportError:
            missing.extend(["torch", "torchaudio"])

    if missing:
        unique = list(dict.fromkeys(missing))
        log.error("Missing Python deps: %s", ", ".join(unique))
        log.error("Install with:")
        log.error("  pip install %s", " ".join(unique))
        sys.exit(1)
    log.info("✓ All dependencies present.")


# ─── Step 1 — extract source audio ────────────────────────────────────
def extract_audio() -> Path:
    log.info("[1/7] Extracting audio from %s …", INPUT.name)
    out = WORK / "src_audio.wav"
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(INPUT),
        "-vn", "-ac", "2", "-ar", "48000",
        "-c:a", "pcm_s16le",
        str(out),
    ])
    return out


# ─── Step 2 — Demucs source separation ────────────────────────────────
def run_demucs(src_wav: Path) -> Path:
    """Returns path to the isolated `vocals.wav` (the only stem we keep)."""
    log.info("[2/7] Running Demucs (htdemucs · two-stem · vocals) …")
    log.info("       This is GPU-accelerated if torch sees a GPU; CPU runs ~1–3 min.")
    out_dir = WORK / "demucs"
    out_dir.mkdir(parents=True, exist_ok=True)
    run([
        sys.executable, "-m", "demucs.separate",
        "-n", "htdemucs",
        "--two-stems", "vocals",
        "-o", str(out_dir),
        str(src_wav),
    ])
    stem_dir = out_dir / "htdemucs" / src_wav.stem
    vocals = stem_dir / "vocals.wav"
    no_vocals = stem_dir / "no_vocals.wav"
    if not vocals.exists():
        log.error("Demucs did not produce vocals.wav — falling back to source audio.")
        return src_wav
    log.info("       Kept: %s  (%.1f KB)", vocals.name, vocals.stat().st_size / 1024)
    log.info("       Discarded: %s  (drone / FX bed lives here)", no_vocals.name)
    return vocals


# ─── Step 3 — synthesize BRAMM if missing ─────────────────────────────
def ensure_bramm() -> Path:
    bramm = ASSETS / "bramm.mp3"
    if bramm.exists():
        log.info("[3/7] Using existing BRAMM at %s", bramm.relative_to(ROOT))
        return bramm
    log.info("[3/7] Synthesizing BRAMM hit at %s …", bramm.relative_to(ROOT))
    bramm.parent.mkdir(parents=True, exist_ok=True)
    # Sub-bass thump @ 50 Hz + hi-pass white-noise crash, fast attack, ~0.65 s tail.
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-t", "1.2", "-i", "sine=f=50",
        "-f", "lavfi", "-t", "1.2", "-i", "anoisesrc=color=white:amplitude=0.6",
        "-filter_complex",
        "[0]volume=2.6[bb];"
        "[1]highpass=f=3500,volume=1.2[bc];"
        "[bb][bc]amix=inputs=2:duration=longest:weights=1 0.55:normalize=0,"
        "afade=t=in:st=0:d=0.005,afade=t=out:st=0.65:d=0.45,"
        "aresample=48000",
        "-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k",
        str(bramm),
    ]
    run(cmd)
    return bramm


# ─── Step 3b — synthesize a cinematic bed (fallback for plan B) ───────
def synthesize_cinematic_bed() -> Path:
    bed = WORK / "cinematic_bed.wav"
    log.info("       Generating fallback cinematic bed (Em9 4-tone pad, 15s)")
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-t", str(TOTAL_DUR), "-i", "sine=f=82.41",   # E2
        "-f", "lavfi", "-t", str(TOTAL_DUR), "-i", "sine=f=164.81",  # E3
        "-f", "lavfi", "-t", str(TOTAL_DUR), "-i", "sine=f=246.94",  # B3
        "-f", "lavfi", "-t", str(TOTAL_DUR), "-i", "sine=f=329.63",  # E4
        "-f", "lavfi", "-t", str(TOTAL_DUR), "-i", "sine=f=415.30",  # Ab4 (jazz tension)
        "-filter_complex",
        "[0]volume=0.32[a];[1]volume=0.26[b];[2]volume=0.20[c];"
        "[3]volume=0.18[d];[4]volume=0.12[e];"
        "[a][b][c][d][e]amix=inputs=5:normalize=0,"
        f"afade=t=in:st=0:d=1,afade=t=out:st={TOTAL_DUR-1.5}:d=1.5,"
        "aresample=48000",
        "-ac", "2", "-c:a", "pcm_s16le",
        str(bed),
    ]
    run(cmd)
    return bed


# ─── Step 4 — build mastered audio (320k AAC · 48 kHz · ducked) ───────
def build_audio_track(
    *, voice_wav: Path | None, bed_wav: Path | None, bramm: Path
) -> Path:
    """
    Build the 15-second mastered audio track.

    Inputs
    ------
    voice_wav : Demucs vocals stem (Plan A) or None for Plan B
    bed_wav   : Cinematic bed (Plan B) or None for Plan A
    bramm     : assets/bramm.mp3

    The voice (Plan A) lives at climax window [3 s … 10 s] of the final
    timeline.  The bed (Plan B) covers all 15 s.  In both plans the
    BRAMM hit at 0:03 sidechain-ducks the underlying bed by ~6 dB so
    the impact lands clean.
    """
    log.info("[4/7] Mastering audio (320 kbps AAC · 48 kHz · sidechain ducking) …")
    out = WORK / "audio.m4a"
    bramm_offset_ms = HOOK_DUR * 1000  # 3 000

    if voice_wav is not None:
        # Plan A — keep only Demucs vocals, place at climax window.
        # Sidechain target = voice (will be ducked by BRAMM trigger).
        vocal_start = SRC_CLIMAX_START
        filter_graph = textwrap.dedent(f"""
            [0:a]atrim={vocal_start}:{vocal_start + CLIMAX_DUR},
                 asetpts=PTS-STARTPTS,
                 aresample=48000,
                 volume=1.45,
                 adelay={HOOK_DUR*1000}|{HOOK_DUR*1000},
                 apad,atrim=0:{TOTAL_DUR}[voice];
            [1:a]aresample=48000,volume=1.6,
                 adelay={bramm_offset_ms}|{bramm_offset_ms},
                 apad,atrim=0:{TOTAL_DUR}[bramm];
            [voice][bramm]sidechaincompress=
                threshold=0.05:ratio=10:attack=4:release=350:makeup=2[ducked];
            [ducked][bramm]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,
                alimiter=limit=0.97,
                atrim=0:{TOTAL_DUR},
                afade=t=out:st={TOTAL_DUR-0.4}:d=0.4
        """).strip().replace("\n", "")
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(voice_wav),
            "-i", str(bramm),
            "-filter_complex", filter_graph,
            "-ac", "2", "-ar", "48000",
            "-c:a", "aac", "-b:a", "320k",
            "-t", str(TOTAL_DUR),
            str(out),
        ]
    else:
        # Plan B — bed only, BRAMM at 3 s, sidechain duck.
        filter_graph = textwrap.dedent(f"""
            [0:a]aresample=48000,
                 atrim=0:{TOTAL_DUR},asetpts=PTS-STARTPTS,
                 volume=0.55,
                 afade=t=in:st=0:d=0.5,
                 afade=t=out:st={TOTAL_DUR-0.6}:d=0.6[bed];
            [1:a]aresample=48000,volume=1.6,
                 adelay={bramm_offset_ms}|{bramm_offset_ms},
                 apad,atrim=0:{TOTAL_DUR}[bramm];
            [bed][bramm]sidechaincompress=
                threshold=0.04:ratio=8:attack=5:release=400:makeup=2[ducked];
            [ducked][bramm]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,
                alimiter=limit=0.97,
                atrim=0:{TOTAL_DUR}
        """).strip().replace("\n", "")
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(bed_wav),
            "-i", str(bramm),
            "-filter_complex", filter_graph,
            "-ac", "2", "-ar", "48000",
            "-c:a", "aac", "-b:a", "320k",
            "-t", str(TOTAL_DUR),
            str(out),
        ]
    run(cmd)
    return out


# ─── Step 5 — render text overlays via Pillow ─────────────────────────
def find_font(candidates: list[str], size: int):
    from PIL import ImageFont
    search_dirs = [
        Path("/Library/Fonts"),
        Path("/System/Library/Fonts/Supplemental"),
        Path("/System/Library/Fonts"),
        Path.home() / "Library/Fonts",
    ]
    for name in candidates:
        for d in search_dirs:
            for ext in ("", ".ttf", ".otf", ".ttc"):
                p = d / f"{name}{ext}"
                if p.exists():
                    try:
                        return ImageFont.truetype(str(p), size)
                    except Exception:
                        continue
    return ImageFont.load_default()


def render_ayne_overlay() -> Path:
    """ARE YOU NOT ENTERTAINED?! — gold #FFD700, anti-aliased, with stroke + glow."""
    log.info("[5/7] Rendering AYNE overlay (Pillow) …")
    from PIL import Image, ImageDraw, ImageFilter
    out = WORK / "ayne.png"
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    font = find_font(["Trattatello", "Didot Bold", "Didot", "Baskerville Bold",
                      "Times New Roman Bold", "Impact"], 138)
    draw = ImageDraw.Draw(canvas)
    text = "ARE YOU NOT\nENTERTAINED?!"

    # Measure
    bbox = draw.multiline_textbbox((0, 0), text, font=font, align="center", spacing=14)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (W - tw) // 2 - bbox[0]
    y = (H - th) // 2 - 120 - bbox[1]

    # 1) Outer glow — render onto separate layer, blur, composite.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.multiline_text((x, y), text, fill=(255, 200, 60, 255),
                         font=font, align="center", spacing=14,
                         stroke_width=14, stroke_fill=(255, 200, 60, 255))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=18))
    canvas = Image.alpha_composite(canvas, glow)

    # 2) Drop shadow
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.multiline_text((x + 4, y + 12), text, fill=(0, 0, 0, 200),
                         font=font, align="center", spacing=14,
                         stroke_width=8, stroke_fill=(0, 0, 0, 200))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=6))
    canvas = Image.alpha_composite(canvas, shadow)

    # 3) Stroke + fill in gold — drawn last so it sits crisply on top.
    fdraw = ImageDraw.Draw(canvas)
    fdraw.multiline_text((x, y), text, fill=GOLD,
                         font=font, align="center", spacing=14,
                         stroke_width=4, stroke_fill=INK)

    canvas.save(out, "PNG")
    return out


def render_endcard() -> Path:
    """Static end-card PNG for the 0:10–0:15 CTA window."""
    log.info("[5b/7] Rendering end-card (Pillow) …")
    from PIL import Image, ImageDraw, ImageFilter
    out = WORK / "endcard.png"

    # Grab a frame at end-of-source for the soft blurred bg.
    bg_jpg = WORK / "endcard_bg.jpg"
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-sseof", "-0.5", "-i", str(INPUT),
        "-frames:v", "1", "-q:v", "2",
        str(bg_jpg),
    ])

    bg = Image.open(bg_jpg).convert("RGB").resize((W, H), Image.LANCZOS)
    bg = bg.filter(ImageFilter.GaussianBlur(radius=24))
    # Multiply with a darkened crimson tint for the imperial feel.
    tint = Image.new("RGB", (W, H), (40, 8, 14))
    bg = Image.blend(bg, tint, 0.55)

    canvas = bg.convert("RGBA")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)

    # Semi-transparent black panel covering the lower 2/3 (per spec)
    od.rectangle([0, int(H * 0.30), W, H], fill=(0, 0, 0, int(0.70 * 255)))

    # Decorative corner brackets
    bracket = 110
    bw = 4
    for (cx, cy, dx, dy) in [
        (60, 60, +1, +1), (W-60-bracket, 60, -1, +1),
        (60, H-60-bracket, +1, -1), (W-60-bracket, H-60-bracket, -1, -1),
    ]:
        od.rectangle([cx, cy, cx + bracket * dx, cy + bw * dy], fill=GOLD_DEEP)
        od.rectangle([cx, cy, cx + bw * dx, cy + bracket * dy], fill=GOLD_DEEP)

    # Badge: "★ 60+ STAGES TO CLEAR ★"
    badge_font = find_font(["Copperplate", "Optima", "Times New Roman Bold"], 36)
    badge_text = "★  60+ STAGES TO CLEAR  ★"
    bb = od.textbbox((0, 0), badge_text, font=badge_font)
    od.text(((W - (bb[2]-bb[0])) // 2, int(H * 0.36)),
            badge_text, fill=GOLD, font=badge_font,
            stroke_width=1, stroke_fill=INK)

    # Headline: MASTER THE ARENA — gold gradient via two-pass render
    head_font = find_font(["Trattatello", "Didot Bold", "Didot",
                           "Baskerville Bold", "Times New Roman Bold"], 132)
    headline = "MASTER\nTHE ARENA"
    hb = od.multiline_textbbox((0, 0), headline, font=head_font,
                                align="center", spacing=8)
    hx = (W - (hb[2] - hb[0])) // 2 - hb[0]
    hy = int(H * 0.40) - hb[1]
    od.multiline_text((hx + 3, hy + 8), headline, fill=(0, 0, 0, 220),
                       font=head_font, align="center", spacing=8,
                       stroke_width=6, stroke_fill=(0, 0, 0, 220))
    od.multiline_text((hx, hy), headline, fill=GOLD,
                       font=head_font, align="center", spacing=8,
                       stroke_width=4, stroke_fill=INK)

    # QR card — solid white block with thick gold border, QR in centre.
    qr_path = ASSETS / "qr_code.png"
    if not qr_path.exists():
        log.warning("       QR not found at %s — skipping QR overlay.", qr_path)
    else:
        qr = Image.open(qr_path).convert("RGB")
        qr_size = 480
        qr_resized = qr.resize((qr_size, qr_size), Image.LANCZOS)
        card_pad = 28
        card_size = qr_size + 2 * card_pad
        card_x = (W - card_size) // 2
        card_y = int(H * 0.62)
        # Gold border
        od.rectangle(
            [card_x - 6, card_y - 6, card_x + card_size + 6, card_y + card_size + 6],
            fill=GOLD_DEEP,
        )
        od.rectangle(
            [card_x, card_y, card_x + card_size, card_y + card_size],
            fill=(255, 255, 255, 255),
        )
        # Composite QR onto canvas at the right pixel coords (paste preserves crispness)
        canvas = Image.alpha_composite(canvas, overlay)  # commit text/badge first
        canvas.paste(qr_resized, (card_x + card_pad, card_y + card_pad))
        # Reset overlay for elements drawn ABOVE the QR
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)

    # URL line
    url_font = find_font(["Trattatello", "Didot Bold", "Didot",
                           "Baskerville Bold", "Times New Roman Bold"], 64)
    url_text = "BaccaratGladiator.com"
    ub = od.textbbox((0, 0), url_text, font=url_font)
    od.text(((W - (ub[2]-ub[0])) // 2, int(H * 0.86)),
             url_text, fill=CREAM, font=url_font,
             stroke_width=2, stroke_fill=INK)

    # Stage ticker — slim list reinforcing variety
    ticker_font = find_font(["Copperplate", "Optima", "Times New Roman"], 26)
    ticker = "MACAU · VEGAS · MONACO · SINGAPORE · TOKYO · DUBAI · COLOSSEUM · MUMBAI · ATLANTIS · KTV"
    tb = od.textbbox((0, 0), ticker, font=ticker_font)
    od.text(((W - (tb[2]-tb[0])) // 2, int(H * 0.92)),
             ticker, fill=(255, 215, 110, 220), font=ticker_font)

    canvas = Image.alpha_composite(canvas, overlay)
    canvas.convert("RGB").save(out, "JPEG", quality=95)
    return out


# ─── Step 6 — assemble video ──────────────────────────────────────────
def build_hook_segment(out_path: Path) -> None:
    """0:00–0:03 — Ken Burns zoom on a source frame, headline overlay."""
    log.info("[6a/7] Building hook segment …")
    hook_bg = WORK / "hook_bg.jpg"
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", "0.5", "-i", str(INPUT),
        "-frames:v", "1", "-q:v", "2", str(hook_bg),
    ])

    headline_png = render_hook_headline()
    # zoompan zooms 1.0→1.18 over HOOK_DUR seconds, scale=lanczos for quality.
    vfilter = (
        f"scale={W*2}:{H*2}:flags=lanczos,"
        f"zoompan=z='min(zoom+0.0008,1.18)':"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={HOOK_DUR*FPS}:s={W}x{H}:fps={FPS}"
    )
    pre_hook = WORK / "_hook_zoom.mp4"
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-loop", "1", "-t", str(HOOK_DUR), "-i", str(hook_bg),
        "-vf", vfilter,
        "-r", str(FPS),
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-an", str(pre_hook),
    ])
    # Composite the headline PNG with a fade-in.
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(pre_hook),
        "-loop", "1", "-t", str(HOOK_DUR), "-i", str(headline_png),
        "-filter_complex",
        "[1:v]format=rgba,fade=t=in:st=0.3:d=0.5:alpha=1[ovl];"
        "[0:v][ovl]overlay=0:0:format=auto",
        "-r", str(FPS),
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-an",
        str(out_path),
    ])


def render_hook_headline() -> Path:
    """THE DRAGON HAS AWAKENED — weathered-stone headline."""
    from PIL import Image, ImageDraw, ImageFilter
    out = WORK / "hook_headline.png"
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(canvas)

    # Top brand mark
    brand_font = find_font(["Copperplate", "Optima", "Times New Roman Bold"], 38)
    brand = "♛  BACCARAT GLADIATOR  ♛"
    bb = od.textbbox((0, 0), brand, font=brand_font)
    od.text(((W - (bb[2]-bb[0])) // 2, 80), brand, fill=CREAM, font=brand_font,
            stroke_width=2, stroke_fill=INK)

    head_font = find_font(["Trattatello", "Didot Bold", "Didot",
                           "Baskerville Bold", "Times New Roman Bold"], 116)
    headline = "THE DRAGON\nHAS AWAKENED"

    # Glow pass
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.multiline_text((W // 2, int(H * 0.78)), headline,
                      anchor="mm", align="center",
                      fill=(255, 200, 60, 220), font=head_font,
                      spacing=10, stroke_width=12, stroke_fill=(255, 200, 60, 220))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=18))
    canvas = Image.alpha_composite(canvas, glow)

    # Main fill
    fd = ImageDraw.Draw(canvas)
    fd.multiline_text((W // 2, int(H * 0.78)), headline,
                      anchor="mm", align="center",
                      fill="#F4D97A", font=head_font, spacing=10,
                      stroke_width=4, stroke_fill=INK)

    # Sub
    sub_font = find_font(["Copperplate", "Optima", "Times New Roman Bold"], 28)
    sub = "EZ  ·  BACCARAT  ·  MACAU  ·  VIP"
    sb = od.textbbox((0, 0), sub, font=sub_font)
    fd.text(((W - (sb[2]-sb[0])) // 2, int(H * 0.86)),
             sub, fill=GOLD, font=sub_font,
             stroke_width=1, stroke_fill=INK)

    canvas.save(out, "PNG")
    return out


def build_climax_segment(ayne_png: Path, out_path: Path) -> None:
    """
    0:03–0:10 — source[2:9] re-encoded with:
      · LANCZOS scale (already at 1080×1920 native, so safe pass-through)
      · `geq` heat-haze on the win window
      · gold AYNE overlay fading in/out on win
    """
    log.info("[6b/7] Building climax segment with heat-haze + AYNE overlay …")
    # geq sinusoidal horizontal warp gives an authentic shimmering heat-haze.
    # Windowed via `enable=between(t, hh_start, hh_end)`.
    geq = (
        "geq="
        "lum='lum(X+5*sin(Y/14+T*9),Y)':"
        "cb='cb(X+5*sin(Y/14+T*9),Y)':"
        "cr='cr(X+5*sin(Y/14+T*9),Y)':"
        f"enable='between(t,{HEAT_HAZE_START},{HEAT_HAZE_END})'"
    )
    overlay = (
        "[1:v]format=rgba,"
        f"fade=t=in:st={WIN_T_IN_CLIMAX-0.1}:d=0.3:alpha=1,"
        f"fade=t=out:st={WIN_T_IN_CLIMAX+1.7}:d=0.6:alpha=1[ayne];"
    )
    fc = (
        f"[0:v]scale={W}:{H}:flags=lanczos,{geq}[v];"
        f"{overlay}"
        f"[v][ayne]overlay=0:0:format=auto"
    )
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", str(SRC_CLIMAX_START), "-t", str(CLIMAX_DUR), "-i", str(INPUT),
        "-loop", "1", "-t", str(CLIMAX_DUR), "-i", str(ayne_png),
        "-filter_complex", fc,
        "-r", str(FPS),
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-an",
        str(out_path),
    ])


def build_cta_segment(endcard_png: Path, out_path: Path) -> None:
    """0:10–0:15 — endcard PNG with subtle fade-in + slow zoom."""
    log.info("[6c/7] Building CTA / end-card segment …")
    vfilter = (
        f"scale={W}:{H}:flags=lanczos,"
        f"zoompan=z='1.00+0.0006*on':d={CTA_DUR*FPS}:s={W}x{H}:fps={FPS},"
        f"fade=t=in:st=0:d=0.4"
    )
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-loop", "1", "-t", str(CTA_DUR), "-i", str(endcard_png),
        "-vf", vfilter,
        "-r", str(FPS),
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-an",
        str(out_path),
    ])


def concat_video_segments(segs: list[Path], out_path: Path) -> None:
    log.info("[6d/7] Concatenating video segments …")
    listfile = WORK / "concat.txt"
    listfile.write_text("\n".join(f"file '{p}'" for p in segs) + "\n")
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", str(listfile),
        "-c", "copy", str(out_path),
    ])


# ─── Step 7 — final mux ───────────────────────────────────────────────
def final_mux(video_only: Path, audio: Path) -> None:
    log.info("[7/7] Muxing video + audio → %s", OUTPUT.name)
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_only),
        "-i", str(audio),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "copy",
        "-movflags", "+faststart",
        "-shortest",
        str(OUTPUT),
    ])


# ─── Main ─────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Render the Dragon 7 → 15s Baccarat Gladiator Short."
    )
    parser.add_argument(
        "--input",
        default=str(INPUT),
        help=f"Source MP4 (default: {INPUT.name}).",
    )
    parser.add_argument(
        "--output",
        default=str(OUTPUT),
        help=f"Output MP4 path (default: {OUTPUT.name}).",
    )
    parser.add_argument(
        "--plan-b",
        metavar="BED.MP3",
        help="Plan B: skip Demucs, mute source, use the supplied cinematic bed.",
    )
    parser.add_argument(
        "--no-demucs",
        action="store_true",
        help="Plan B with an auto-synthesized cinematic bed.",
    )
    args = parser.parse_args()

    global INPUT, OUTPUT
    INPUT = Path(args.input).resolve()
    OUTPUT = Path(args.output).resolve()
    if not INPUT.exists():
        log.error("Source video not found: %s", INPUT)
        return 1

    use_demucs = not (args.plan_b or args.no_demucs)
    check_dependencies(use_demucs)

    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    bramm = ensure_bramm()

    # Audio
    if use_demucs:
        src_audio = extract_audio()
        voice = run_demucs(src_audio)
        audio = build_audio_track(voice_wav=voice, bed_wav=None, bramm=bramm)
    else:
        bed = Path(args.plan_b).resolve() if args.plan_b else synthesize_cinematic_bed()
        if not bed.exists():
            log.error("Plan B bed track not found: %s", bed)
            return 1
        log.info("Plan B engaged: source muted, bed = %s", bed.name)
        audio = build_audio_track(voice_wav=None, bed_wav=bed, bramm=bramm)

    # Video
    ayne = render_ayne_overlay()
    endcard = render_endcard()

    hook_mp4   = WORK / "seg_hook.mp4"
    climax_mp4 = WORK / "seg_climax.mp4"
    cta_mp4    = WORK / "seg_cta.mp4"
    build_hook_segment(hook_mp4)
    build_climax_segment(ayne, climax_mp4)
    build_cta_segment(endcard, cta_mp4)

    video_only = WORK / "video_only.mp4"
    concat_video_segments([hook_mp4, climax_mp4, cta_mp4], video_only)

    final_mux(video_only, audio)

    size_mb = OUTPUT.stat().st_size / 1024 / 1024
    log.info("──────────────────────────────────────────────")
    log.info("✓ %s", OUTPUT)
    log.info("  %.2f MB · 15.000s · %dx%d · %dfps · H.264 + AAC 320k @ 48kHz",
             size_mb, W, H, FPS)
    log.info("──────────────────────────────────────────────")
    return 0


if __name__ == "__main__":
    sys.exit(main())
