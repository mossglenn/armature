"""Build Armature app icons

Requires rsvg-convert (librsvg) and Pillow. Run: python3 build_icons.py icons/
 (macOS .icns, Windows .ico, Linux PNGs) from the BRAND.md symbol.

Symbol geometry is copied verbatim from brand/armature-mark*.svg (viewBox -2 0 104 90).
Colors: Graphite #1F2125 tile, Paper #F7F6F3 mark (the mark-on-dark variant).
Rule from BRAND.md: full symbol at >= 32 px of symbol width; small symbol (heavier wire,
no wire tail) below that. The tile is a ground, not part of the mark: no gradient, glow or shadow.
"""
import math, subprocess, sys, pathlib

GRAPHITE, PAPER = "#1F2125", "#F7F6F3"
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out")
OUT.mkdir(parents=True, exist_ok=True)

CUT = '<clipPath id="cut"><polygon points="-10,-10 86.3,-10 86.3,0 30.2,88 -10,88"/></clipPath>'

def symbol(small: bool, ink: str) -> str:
    body = (f'<g clip-path="url(#cut)" fill="{ink}">'
            f'<path d="M8.3 96 L50 6 L91.7 96" fill="none" stroke="{ink}" stroke-width="22" stroke-linejoin="bevel"/>'
            f'<rect x="23.1" y="53" width="53.8" height="22"/></g>')
    if small:
        wire = (f'<path d="M15.7 80 L50 12 L84.3 80 M27.1 64 L76.2 64" fill="none" stroke="{ink}" '
                f'stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>')
    else:
        wire = (f'<g fill="none" stroke="{ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'
                f'<path d="M15.7 80 L50 12 L84.3 80 M27.1 64 L72.5 63.7"/>'
                f'<path transform="translate(76.2 64) rotate(63.24)" d="M-2 3.2 C0 3.2 0 -3.2 2 -3.2 C4 -3.2 4 3.2 6 3.2 C8 3.2 8 -3.2 10 -3.2 C12 -3.2 12 0 14 0"/></g>')
    return body + wire

def squircle(x, y, w, h, n=5.0, steps=720) -> str:
    """Superellipse approximating Apple's continuous-corner icon shape."""
    cx, cy, a, b = x + w / 2, y + h / 2, w / 2, h / 2
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(c) ** (2 / n), c), cy + b * math.copysign(abs(s) ** (2 / n), s)))
    return "M" + " L".join(f"{px:.2f} {py:.2f}" for px, py in pts) + " Z"

def icon_svg(canvas, plate, mark_w, shape, small_override=None) -> tuple[str, bool]:
    """plate = (x, y, size). mark_w = letter width in canvas px (letter spans x 0..100 in symbol units)."""
    px, py, ps = plate
    s = mark_w / 100.0
    # symbol-width in output px decides full vs small, per BRAND.md minimum sizes
    small = small_override if small_override is not None else (mark_w < 32)
    cx, cy = px + ps / 2, py + ps / 2
    # letter axis x=50 on the tile's center; content spans y 1.4..88 -> centre 44.7, nudged up 1% of tile
    tx, ty = cx - 50 * s, cy - 44.7 * s - 0.01 * ps
    if shape == "squircle":
        plate_el = f'<path d="{squircle(px, py, ps, ps)}" fill="{GRAPHITE}"/>'
    else:
        r = ps * 0.18
        plate_el = f'<rect x="{px}" y="{py}" width="{ps}" height="{ps}" rx="{r:.2f}" fill="{GRAPHITE}"/>'
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{canvas}" height="{canvas}" viewBox="0 0 {canvas} {canvas}">'
           f'<defs>{CUT}</defs>{plate_el}'
           f'<g transform="translate({tx:.3f} {ty:.3f}) scale({s:.5f})">{symbol(small, PAPER)}</g></svg>')
    return svg, small

def render(svg: str, size: int, name: str) -> pathlib.Path:
    src = OUT / f"_{name}.svg"
    src.write_text(svg)
    png = OUT / f"{name}.png"
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), str(src), "-o", str(png)], check=True)
    return png

# ---- macOS: Apple grid (824 tile on 1024, 100 margin). Small sizes get a fuller tile so the A stays legible.
def mac(size):
    if size >= 64:
        c = 1024; plate = (100, 100, 824); mw = 500
    else:  # 16 / 32 px: tile at ~94% of canvas, letter at ~66% of tile
        c = 1024; plate = (32, 32, 960); mw = 640
    svg, small = icon_svg(c, plate, mw, "squircle", small_override=(mw * size / c) < 32)
    return svg, small

# ---- Windows: near full-bleed rounded plate (Windows draws no mask), letter ~62% of plate; small sizes fuller.
def win(size):
    if size >= 64:
        c = 256; plate = (8, 8, 240); mw = 150
    else:
        c = 256; plate = (0, 0, 256); mw = 176
    svg, small = icon_svg(c, plate, mw, "rect", small_override=(mw * size / c) < 32)
    return svg, small

if __name__ == "__main__":
    from PIL import Image
    report = []
    mac_imgs = {}
    for sz in (16, 32, 64, 128, 256, 512, 1024):
        svg, small = mac(sz)
        mac_imgs[sz] = Image.open(render(svg, sz, f"mac-{sz}")).convert("RGBA")
        report.append(f"mac {sz:>4}: {'small' if small else 'full '} symbol")
    win_imgs = {}
    for sz in (16, 20, 24, 32, 40, 48, 64, 256):
        svg, small = win(sz)
        win_imgs[sz] = Image.open(render(svg, sz, f"win-{sz}")).convert("RGBA")
        report.append(f"win {sz:>4}: {'small' if small else 'full '} symbol")
    # master SVGs kept for future regeneration
    note = ("<!-- Armature app icon, {0} master (generated by build_icons.py; edit the script, not this file).\n"
            "     Symbol and colors per BRAND.md: Paper cutaway A on a Graphite tile. Sizes below {1} px use\n"
            "     separate small-symbol artwork, so regenerate with: python3 build_icons.py <out-dir> -->\n")
    (OUT / "source.svg").write_text(note.format("macOS (Apple 824/1024 grid)", 128) + mac(1024)[0])
    (OUT / "icon-windows.svg").write_text(note.format("Windows / Linux", 48) + win(256)[0])
    # .icns (Pillow writes ic04..ic10 incl. @2x slots from the matching sizes)
    # Written by hand: Pillow omits the 1x 16/32 slots (icp4/icp5), which 1x displays use for list views.
    import struct
    slots = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256), ("ic09", 512),
             ("ic10", 1024), ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)]
    chunks = b"".join(t.encode() + struct.pack(">I", 8 + len(d)) + d
                      for t, d in ((t, (OUT / f"mac-{sz}.png").read_bytes()) for t, sz in slots))
    (OUT / "icon.icns").write_bytes(b"icns" + struct.pack(">I", 8 + len(chunks)) + chunks)
    # .ico: every size supplied explicitly so small sizes keep their own artwork
    base = win_imgs[256]
    base.save(OUT / "icon.ico", sizes=[(s, s) for s in sorted(win_imgs)],
              append_images=[win_imgs[s] for s in sorted(win_imgs) if s != 256])
    print("\n".join(report))
    # Tauri's PNG slots (used for Linux bundles and the window icon): Windows artwork
    for name, sz in (("32x32", 32), ("128x128", 128), ("128x128@2x", 256), ("icon", 512)):
        svg, _ = win(sz)
        p = render(svg, sz, f"tauri-{name}")
        p.rename(OUT / f"{name}.png")
    for f in OUT.glob("_*.svg"):
        f.unlink()
